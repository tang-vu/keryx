/**
 * "From the archive" — the related-answers block at the foot of a dispatch
 * permalink. Server-rendered links between answer pages turn the archive from
 * a set of leaf pages into a walkable mesh: crawlers discover the corpus by
 * following these, and a reader landing from search gets a next question to pull.
 */

import Link from "next/link";
import type { ArchiveEntry } from "@/lib/answers-archive";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function RelatedDispatches({ entries }: { entries: ArchiveEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section aria-label="Related dispatches" className="mt-14 border-t border-ink pt-8">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-seal">
        From the archive
      </div>
      <h2 className="font-display text-[22px] font-medium tracking-tight text-ink">
        Related dispatches
      </h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {entries.map((e) => (
          <Link
            key={e.id}
            href={`/dispatch/${e.id}`}
            className="group block border border-ink bg-paper p-4 transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)]"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-seal">
                Dispatch
              </span>
              <time className="font-mono text-[9.5px] text-ink-3" dateTime={e.createdAt}>
                {fmtDate(e.createdAt)}
              </time>
            </div>
            <div className="mt-1.5 font-display text-[16px] font-medium leading-snug text-ink transition-colors group-hover:text-seal">
              {e.question}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
              <span>
                {e.citationCount} source{e.citationCount !== 1 ? "s" : ""} cited
              </span>
              <span className="text-paid">${e.toCreators.toFixed(4)} to creators</span>
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-5">
        <Link
          href="/answers"
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 underline decoration-ink-3 underline-offset-4 transition-colors hover:text-ink"
        >
          Browse the full archive ▸
        </Link>
      </div>
    </section>
  );
}
