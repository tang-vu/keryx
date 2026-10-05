import type { KeryxDB } from "../db/keryx-db";
import type { ContentDeliveryKind, QueryRun } from "../types";
import { hasKnownSyntheticFingerprint } from "../research/evidence-provenance";

const RUN_LIMIT = 50;
const DOCUMENT_LIMIT = 40;
const CITATIONS_PER_RUN = 100;
const DELIVERY_KINDS: readonly string[] = ["full_text", "excerpt", "abstract", "metadata_only"];
const EXTRACTION_KINDS: readonly string[] = ["html", "text", "pdf"];

export interface CitedSourceHistoryEntry {
  url: string;
  title: string;
  /** Recorded source name, not verified authorship or publisher ownership. */
  publisher: string;
  runId: string;
  citedAt: string;
  deliveryKind?: ContentDeliveryKind;
  truncated?: boolean;
  retrievedAt?: string;
  extraction?: "html" | "text" | "pdf";
}

function isPublicRun(run: QueryRun): boolean {
  return !!run && typeof run.id === "string" && run.id.trim().length > 0 && run.id.length <= 256 &&
    !/^prv_/i.test(run.id) && typeof run.createdAt === "string" &&
    run.createdAt.length <= 64 && Number.isFinite(Date.parse(run.createdAt));
}

function documentKey(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2048 || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    // A section link remains visible on the original entry, but is not another document.
    url.hash = "";
    return url.href;
  } catch { return null; }
}

/**
 * Presentation-only citations from the same public query_runs store as /api/runs.
 * Private research persists in a separate owner-scoped result store; reject its
 * reserved ID prefix as an additional boundary. Never load private results or bodies.
 * runCount is the number of valid public runs inspected, including uncited runs,
 * within the latest 50 returned records. Entries retain the newest citation snapshot.
 * A failed read throws so the caller can distinguish unavailable from empty history.
 */
export async function loadCitedSourceHistory(db: Pick<KeryxDB, "listRecentQueries">): Promise<{
  entries: CitedSourceHistoryEntry[];
  runCount: number;
}> {
  const returned = await db.listRecentQueries(RUN_LIMIT);
  if (!Array.isArray(returned)) throw new Error("Public source history unavailable");
  const seenRuns = new Set<string>();
  const runs = returned.slice(0, RUN_LIMIT).filter(isPublicRun)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
    .filter(run => {
      if (seenRuns.has(run.id)) return false;
      seenRuns.add(run.id);
      return true;
    });
  const documents = new Map<string, CitedSourceHistoryEntry>();
  for (const run of runs) {
    if (typeof run.answer !== "string" || !run.answer.trim() || !Array.isArray(run.citations)) continue;
    for (const citation of run.citations.slice(0, CITATIONS_PER_RUN)) {
      if (!citation || citation.sourceKind !== "public-reference" || citation.evidenceProvenance === "synthetic-demo" ||
        hasKnownSyntheticFingerprint(citation) || typeof citation.itemTitle !== "string" || !citation.itemTitle.trim()) continue;
      const key = documentKey(citation.itemUrl);
      if (!key || documents.has(key) || documents.size >= DOCUMENT_LIMIT) continue;
      const provenance = citation.webProvenance;
      const deliveryKind = DELIVERY_KINDS.includes(citation.publicDeliveryKind ?? "") ? citation.publicDeliveryKind : undefined;
      const retrievedAt = typeof provenance?.retrievedAt === "string" && provenance.retrievedAt.length <= 64 &&
        Number.isFinite(Date.parse(provenance.retrievedAt)) ? provenance.retrievedAt : undefined;
      const extraction = EXTRACTION_KINDS.includes(provenance?.extraction ?? "") ? provenance?.extraction : undefined;
      documents.set(key, {
        url: citation.itemUrl!, title: citation.itemTitle.trim().slice(0, 1000),
        publisher: typeof citation.sourceName === "string" && citation.sourceName.trim()
          ? citation.sourceName.trim().slice(0, 200) : "Publication not recorded",
        runId: run.id, citedAt: run.createdAt,
        ...(deliveryKind ? { deliveryKind } : {}),
        ...(typeof provenance?.truncated === "boolean" ? { truncated: provenance.truncated } : {}),
        ...(retrievedAt ? { retrievedAt } : {}),
        ...(extraction ? { extraction } : {}),
      });
    }
  }
  return { entries: [...documents.values()], runCount: runs.length };
}
