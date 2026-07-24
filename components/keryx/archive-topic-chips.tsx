/**
 * The archive's topic rail. Real links to real pages, not client-side filters: these are the
 * corpus's own hub pages, and a crawler (or a reader without JS) has to be able to follow them.
 * The active topic renders as a marked chip rather than a link back to itself.
 */

import Link from "next/link";
import type { ArchiveTopic } from "@/lib/answers-topics";

const CHIP =
  "border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors";

export function ArchiveTopicChips({
  topics,
  activeSlug,
}: {
  topics: ArchiveTopic[];
  activeSlug?: string;
}) {
  if (topics.length === 0) return null;
  return (
    <nav aria-label="Answer topics" className="mt-6 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
        Topics
      </span>
      {activeSlug && (
        <Link href="/answers" className={`${CHIP} border-line text-ink-3 hover:border-ink hover:text-ink`}>
          ← all
        </Link>
      )}
      {topics.map((t) =>
        t.slug === activeSlug ? (
          <span key={t.slug} className={`${CHIP} border-ink bg-ink text-paper`}>
            {t.label} {t.count}
          </span>
        ) : (
          <Link
            key={t.slug}
            href={`/answers/topic/${t.slug}`}
            className={`${CHIP} border-line text-ink-2 hover:border-seal hover:text-seal`}
          >
            {t.label} <span className="text-ink-3">{t.count}</span>
          </Link>
        ),
      )}
    </nav>
  );
}
