/**
 * The archive's topic rail. Real links to real pages, not client-side filters: these are the
 * corpus's own hub pages, and a crawler (or a reader without JS) has to be able to follow them.
 * The active topic renders as a marked chip rather than a link back to itself.
 */

import { createMessages } from "@/lib/i18n/messages";
import Link from "next/link";
import type { ArchiveTopic } from "@/lib/answers-topics";
import { UiElement, UiMessage } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");

const CHIP =
  "inline-flex min-h-11 items-center gap-1.5 border px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal";

export function ArchiveTopicChips({
  topics,
  activeSlug,
}: {
  topics: ArchiveTopic[];
  activeSlug?: string;
}) {
  if (topics.length === 0) return null;
  return (
    <UiElement as="nav" names={["aria-label"]} attributes={{ "aria-label": copy("archiveTopics.label"), "className": "mt-6 flex flex-wrap items-center gap-1.5" }}>
      <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
        <UiMessage messageKey={"archiveTopics.title"} />
      </span>
      {activeSlug && (
        <Link href="/answers" className={`${CHIP} border-line bg-paper text-ink-3 hover:border-ink hover:text-ink`}>
          <UiMessage messageKey={"archiveTopics.all"} />
        </Link>
      )}
      {topics.slice(0, 5).map((t) =>
        t.slug === activeSlug ? (
          <span key={t.slug} aria-current="page" className={`${CHIP} border-ink bg-ink text-paper`}>
            {t.label} {t.count}
          </span>
        ) : (
          <Link
            key={t.slug}
            href={`/answers/topic/${t.slug}`}
            className={`${CHIP} border-line bg-paper text-ink-2 hover:border-seal hover:text-seal`}
          >
            {t.label} <span className="text-ink-3">{t.count}</span>
          </Link>
        ),
      )}
      {topics.length > 5 && (
        <details className="w-full">
          <summary className={`${CHIP} inline-flex min-h-11 cursor-pointer items-center border-line text-ink-2`}><UiMessage messageKey={topics.length - 5 === 1 ? "archiveTopics.more.one" : "archiveTopics.more.other"} values={{ count: topics.length - 5 }} /></summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {topics.slice(5).map((t) => t.slug === activeSlug ? (
              <span key={t.slug} aria-current="page" className={`${CHIP} border-ink bg-ink text-paper`}>{t.label} {t.count}</span>
            ) : (
              <Link key={t.slug} href={`/answers/topic/${t.slug}`} className={`${CHIP} border-line bg-paper text-ink-2 hover:border-seal hover:text-seal`}>{t.label} <span className="text-ink-3">{t.count}</span></Link>
            ))}
          </div>
        </details>
      )}
    </UiElement>
  );
}
