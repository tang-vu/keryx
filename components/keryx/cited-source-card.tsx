import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CitedSourceHistoryEntry } from "@/lib/sources/cited-source-history";

const SCOPE_LABELS = {
  full_text: "Full text recorded", excerpt: "Excerpt recorded",
  abstract: "Abstract recorded", metadata_only: "Metadata only",
};
function dateLabel(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

/** Public citation metadata; never content delivery, ownership or payment authority. */
export function CitedSourceCard({ entry, compact = false }: { entry: CitedSourceHistoryEntry; compact?: boolean }) {
  const cited = dateLabel(entry.citedAt);
  const retrieved = dateLabel(entry.retrievedAt);
  return <article className="flex min-w-0 flex-col border border-line bg-paper p-5 sm:p-6">
    <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-paid">Cited public document</p>
    <h3 className={`mt-2 font-display text-xl font-medium leading-snug text-ink ${compact ? "line-clamp-3" : ""}`}>
      <a href={entry.url} target="_blank" rel="noopener noreferrer" className="break-words hover:text-seal">{entry.title}<ArrowUpRight aria-hidden="true" className="ml-1 inline h-4 w-4" /></a>
    </h3>
    <p className="mt-2 break-words font-mono text-[11px] text-ink-3">{entry.publisher}</p>
    <p className="mt-4 text-sm leading-relaxed text-ink-2">
      {entry.deliveryKind ? SCOPE_LABELS[entry.deliveryKind] : "Reading scope not recorded"}
      {entry.truncated && " · Bounded extraction"}
    </p>
    {!compact && <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-3">{retrieved ? <>Read observed <time dateTime={entry.retrievedAt}>{retrieved}</time></> : "Read time not recorded"}</p>}
    <div className="mt-auto pt-4">
      <p className="font-mono text-[11px] leading-relaxed text-ink-3">{cited ? <>Last cited <time dateTime={entry.citedAt}>{cited}</time></> : "Citation date not recorded"}</p>
      <Link href={`/dispatch/${encodeURIComponent(entry.runId)}`} className="mt-1 inline-block min-h-11 py-3 font-mono text-[11px] text-seal underline underline-offset-4">Inspect cited answer →</Link>
    </div>
  </article>;
}
