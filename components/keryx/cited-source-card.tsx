import { DisplayTime } from "@/components/keryx/display-time";
import { formatDate } from "@/lib/i18n/format";
import { createMessages } from "@/lib/i18n/messages";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { CitedSourceHistoryEntry } from "@/lib/sources/cited-source-history";
import { UiMessage, UiRichMessage, UiText } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");


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
  return <article className="flex min-w-0 flex-col border border-line bg-paper p-5 transition-colors hover:border-brass focus-within:border-brass [overflow-wrap:anywhere] sm:p-6">
    <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-paid"><UiMessage messageKey={"sourceCited.kicker"} /></p>
    <h3 className="mt-2 font-display text-[23px] font-medium leading-snug text-ink">
      <a href={entry.url} target="_blank" rel="noopener noreferrer" className={`group min-h-11 hover:text-seal focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-seal ${compact ? "line-clamp-3" : "block"}`}>{entry.title}<ArrowUpRight aria-hidden="true" className="ml-1 inline h-4 w-4 motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5" /></a>
    </h3>
    <p className="mt-2 break-words font-mono text-[11px] text-ink-3">{entry.publisher}</p>
    <p className="mt-4 border-l-2 border-line pl-3 font-serif text-[15px] leading-relaxed text-ink-2">
      {entry.deliveryKind ? (SCOPE_LABELS[entry.deliveryKind]?.[entry.truncated ? 1 : 0] ?? (entry.truncated ? copy("sourceCited.unclassifiedBounded") : undefined)) : <UiMessage messageKey={entry.truncated ? "sourceCited.scopeBounded.unrecorded" : "sourceCited.scope.unrecorded"} />}
    </p>
    {!compact && <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-3">{retrieved ? <><UiRichMessage messageKey={"sourceCited.observed"} values={{ date: <DisplayTime value={entry.retrievedAt!} dateOnly /> }} /></> : copy("sourceCited.readUnavailable")}</p>}
    <div className="mt-auto pt-5"><div className="border-t border-line pt-3">
      <p className="font-mono text-[11px] leading-relaxed text-ink-3">{cited ? <><UiRichMessage messageKey={"sourceCited.lastCited"} values={{ date: <DisplayTime value={entry.citedAt!} dateOnly /> }} /></> : copy("sourceCited.citationUnavailable")}</p>
      <Link href={`/dispatch/${encodeURIComponent(entry.runId)}`} className="mt-1 inline-flex min-h-11 items-center py-2 font-mono text-[11px] text-seal underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"><UiMessage messageKey={"sourceCited.inspect"} /></Link>
    </div></div>
  </article>;
}
