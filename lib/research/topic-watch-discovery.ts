import { crossrefRecord } from "../scholarly/crossref";
import { doiUrl } from "../scholarly/doi";
import { fetchMetadata, type MetadataFetch } from "../scholarly/provider";
import { paperRecordSchema } from "../papers/types";
import type { TopicWatchMetadataPort } from "./topic-watches";

/** One explicitly admitted official metadata page, never a document/model/payment capability. */
export function createCurrentTopicWatchMetadata(fetcher: MetadataFetch = fetchMetadata): TopicWatchMetadataPort {
  return Object.freeze({
    async read(request, signal) {
      if (request.scope !== "metadata-only" || !Number.isInteger(request.maximumRows) || request.maximumRows < 1 || request.maximumRows > 32 ||
        !Number.isSafeInteger(request.deadlineAtMs) || request.deadlineAtMs <= Date.now() || signal?.aborted ||
        !request.keywords.length || request.keywords.length > 8 || request.keywords.some(term => typeof term !== "string" || !term.trim() || term.length > 80))
        throw new Error("Metadata check unavailable");
      const limit = Math.min(6, request.maximumRows);
      const url = new URL("https://api.crossref.org/works");
      url.searchParams.set("query.bibliographic", request.keywords.join(" "));
      url.searchParams.set("sort", "indexed"); url.searchParams.set("order", "desc"); url.searchParams.set("rows", String(limit));
      if (url.href.length > 4096) throw new Error("Metadata query limit");
      const deadline = AbortSignal.timeout(Math.min(6000, request.deadlineAtMs - Date.now()));
      const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      let stop!: () => void;
      const stopped = new Promise<never>((_resolve, reject) => {
        stop = () => reject(new Error("Metadata check ended"));
        boundedSignal.addEventListener("abort", stop, { once: true });
        if (boundedSignal.aborted) stop();
      });
      let text: string;
      try {
        const read = Promise.resolve().then(() => {
          if (boundedSignal.aborted) throw new Error("Metadata check ended");
          return fetcher(url.href, boundedSignal);
        });
        text = await Promise.race([read, stopped]);
      } finally { boundedSignal.removeEventListener("abort", stop); }
      if (boundedSignal.aborted || Date.now() >= request.deadlineAtMs || new TextEncoder().encode(text).length > 250_000)
        throw new Error("Metadata check ended");
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || !("status" in parsed) || parsed.status !== "ok" || !("message" in parsed) ||
        !parsed.message || typeof parsed.message !== "object" || !("items" in parsed.message) || !Array.isArray(parsed.message.items) ||
        parsed.message.items.length > limit) throw new Error("Invalid metadata page");
      const observedAt = new Date().toISOString();
      const rows = parsed.message.items.map(value => {
        const metadata = crossrefRecord(value, observedAt);
        if (!metadata) return { state: "unknown" as const, reason: "incomplete-metadata" as const };
        const record = paperRecordSchema.safeParse({ title: metadata.title, authors: metadata.authors,
          authorCount: metadata.authorCount ?? metadata.authors.length,
          authorsTruncated: (metadata.authorCount ?? metadata.authors.length) > metadata.authors.length,
          ...(metadata.publishedDate ? { publishedYear: Number(metadata.publishedDate.slice(0, 4)) } : {}),
          ...(metadata.journal ? { venue: metadata.journal } : {}), doi: metadata.doi,
          repository: "crossref", url: doiUrl(metadata.doi!), metadataUrl: metadata.recordUrl,
          metadataObservedAt: observedAt, publicationKind: metadata.workType === "journal-article" ? "journal-article" : metadata.workType === "preprint" ? "preprint" : "unknown",
          peerReview: "unknown" });
        return record.success ? { state: "observed" as const, record: record.data }
          : { state: "unknown" as const, reason: "incomplete-metadata" as const };
      });
      return { version: 1, scope: "metadata-only", status: rows.length ? "available" : "empty", complete: true, rows };
    },
  } satisfies TopicWatchMetadataPort);
}

export const currentTopicWatchMetadata = createCurrentTopicWatchMetadata();
