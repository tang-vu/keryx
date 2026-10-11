import { DisplayTime } from "@/components/keryx/display-time";
import { formatDate } from "@/lib/i18n/format";
import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CitedSourceHistoryEntry } from "@/lib/sources/cited-source-history";

const copy = createMessages("en");
const richCopy = createRichMessages("en");

const SCOPE_LABELS = {
  full_text: [copy("sourceCited.scope.full_text"), copy("sourceCited.scopeBounded.full_text")],
  excerpt: [copy("sourceCited.scope.excerpt"), copy("sourceCited.scopeBounded.excerpt")],
  abstract: [copy("sourceCited.scope.abstract"), copy("sourceCited.scopeBounded.abstract")],
  metadata_only: [copy("sourceCited.scope.metadata_only"), copy("sourceCited.scopeBounded.metadata_only")],
};
function dateLabel(value?: string) {
  return value ? formatDate(value) : null;
}

/** Public citation metadata; never content delivery, ownership or payment authority. */
export function CitedSourceCard({ entry, compact = false }: { entry: CitedSourceHistoryEntry; compact?: boolean }) {
  const cited = dateLabel(entry.citedAt);
  const retrieved = dateLabel(entry.retrievedAt);
  return <article className="flex min-w-0 flex-col border border-line bg-paper p-5 sm:p-6">
    <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-paid">{copy("sourceCited.kicker")}</p>
    <h3 className={`mt-2 font-display text-xl font-medium leading-snug text-ink ${compact ? "line-clamp-3" : ""}`}>
      <a href={entry.url} target="_blank" rel="noopener noreferrer" className="break-words hover:text-seal">{entry.title}<ArrowUpRight aria-hidden="true" className="ml-1 inline h-4 w-4" /></a>
    </h3>
    <p className="mt-2 break-words font-mono text-[11px] text-ink-3">{entry.publisher}</p>
    <p className="mt-4 text-sm leading-relaxed text-ink-2">
      {entry.deliveryKind ? (SCOPE_LABELS[entry.deliveryKind]?.[entry.truncated ? 1 : 0] ?? (entry.truncated ? copy("sourceCited.unclassifiedBounded") : undefined)) : copy(entry.truncated ? "sourceCited.scopeBounded.unrecorded" : "sourceCited.scope.unrecorded")}
    </p>
    {!compact && <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-3">{retrieved ? <>{richCopy("sourceCited.observed", { date: <DisplayTime value={entry.retrievedAt!} dateOnly /> })}</> : copy("sourceCited.readUnavailable")}</p>}
    <div className="mt-auto pt-4">
      <p className="font-mono text-[11px] leading-relaxed text-ink-3">{cited ? <>{richCopy("sourceCited.lastCited", { date: <DisplayTime value={entry.citedAt!} dateOnly /> })}</> : copy("sourceCited.citationUnavailable")}</p>
      <Link href={`/dispatch/${encodeURIComponent(entry.runId)}`} className="mt-1 inline-block min-h-11 py-3 font-mono text-[11px] text-seal underline underline-offset-4">{copy("sourceCited.inspect")}</Link>
    </div>
  </article>;
}
