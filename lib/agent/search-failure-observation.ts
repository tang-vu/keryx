import type { SearchProvider } from "../web-research/search-provider";
import { ResearchAdmissionHeldError } from "../research/availability-contract";

const MAX_ATTEMPTS = 9;
interface Outcomes { attemptedQueries: number; succeededQueries: number; failedQueries: number }
export interface SearchFailureObservation {
  kind: "public-search-failures-v1";
  admissionHeld: number;
  signalAborted: number;
  unclassified: number;
}

/**
 * Only the server-owned Tavily constructor path may use this observer. Its vendor
 * exceptions are already redacted; typed admission errors escape before HTTP.
 * Injected providers have no such provenance and keep their original behavior.
 * This records counts only, never supplier billing, evidence or admission authority.
 */
export function observeTrustedTavilySearch(provider: SearchProvider) {
  let attempted = 0, succeeded = 0, failed = 0, overflow = false;
  let admissionHeld = 0, signalAborted = 0, unclassified = 0;
  return {
    provider: {
      async search(query: string, signal?: AbortSignal) {
        const counted = attempted < MAX_ATTEMPTS;
        if (counted) attempted++;
        else overflow = true;
        try {
          const result = await provider.search(query, signal);
          if (counted) succeeded++;
          return result;
        } catch (error) {
          if (counted) {
            failed++;
            let reason: "admissionHeld" | "signalAborted" | "unclassified" = "unclassified";
            // No message, stack, code, cause or other exception property is read.
            // A hostile prototype/signal trap must not replace the original error.
            try {
              if (error instanceof ResearchAdmissionHeldError) reason = "admissionHeld";
              else if (signal?.aborted) reason = "signalAborted";
            } catch { /* observation unavailable; preserve original provider failure */ }
            if (reason === "admissionHeld") admissionHeld++;
            else if (reason === "signalAborted") signalAborted++;
            else unclassified++;
          }
          throw error;
        }
      },
    } satisfies SearchProvider,
    failureDetail(outcomes: Outcomes): Readonly<SearchFailureObservation> | undefined {
      if (overflow || failed === 0 || ![outcomes.attemptedQueries, outcomes.succeededQueries, outcomes.failedQueries].every(value => Number.isInteger(value) && value >= 0 && value <= MAX_ATTEMPTS)
        || outcomes.attemptedQueries !== attempted || outcomes.succeededQueries !== succeeded || outcomes.failedQueries !== failed
        || attempted !== succeeded + failed || failed !== admissionHeld + signalAborted + unclassified) return undefined;
      return Object.freeze({ kind: "public-search-failures-v1", admissionHeld, signalAborted, unclassified });
    },
  };
}
