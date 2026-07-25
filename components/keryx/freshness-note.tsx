/**
 * "Does this answer still stand?" — the freshness strip under an archived dispatch.
 *
 * Three states. When the cited sources have published since the dispatch settled, it says how much
 * and offers a re-ask (a full paid dispatch — the creators get paid again, which is the whole
 * point). When the sources Keryx actually polls have published nothing, it says *that*, which is
 * the stronger claim: this answer was read from the latest material they hold. And when none of
 * the cited sources lists a feed, it says nothing at all — Keryx never re-reads those, so their
 * silence is ignorance, not evidence, and a reassuring note would be a lie of omission.
 *
 * It never claims the new posts change the answer. Deciding that would mean buying and re-reading
 * them, and the reader is the one who gets to spend that.
 */

import Link from "next/link";
import type { Freshness } from "@/lib/answers-freshness";

interface Props {
  freshness: Freshness;
  /** The dispatch this note sits under — the re-ask is threaded onto it. */
  dispatchId: string;
  question: string;
}

/**
 * "…published by X" — the subject of the sentence. Spelled out rather than always "M of the N",
 * which reads absurdly ("1 of the 1 source") in the common case where every cited source moved.
 */
function publisherPhrase(moved: number, cited: number): string {
  if (moved === cited) {
    return cited === 1 ? "the one source this answer cited" : `all ${cited} sources this answer cited`;
  }
  return `${moved} of the ${cited} sources this answer cited`;
}

export function FreshnessNote({ freshness, dispatchId, question }: Props) {
  // Nothing cited (or nothing still on sale) — there is no claim to make either way.
  if (freshness.citedCount === 0) return null;

  const { newItems, sources, citedCount, watchedCount } = freshness;

  if (newItems === 0) {
    // No feed among the cited sources = nothing to have noticed with. Stay quiet.
    if (watchedCount === 0) return null;
    const subject =
      watchedCount === citedCount
        ? citedCount === 1
          ? "The source cited here has"
          : `All ${citedCount} sources cited here have`
        : watchedCount === 1
          ? "The one cited source Keryx follows a feed for has"
          : `The ${watchedCount} of ${citedCount} cited sources Keryx follows a feed for have`;
    return (
      <section
        aria-label="Answer freshness"
        className="mt-8 max-w-[860px] border-l-2 border-line pl-4"
      >
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
          Still current
        </p>
        <p className="mt-1.5 font-serif text-[14.5px] leading-[1.6] text-ink-2">
          {subject} published nothing new since this dispatch settled.
        </p>
      </section>
    );
  }

  // A re-ask is the same question again: it inherits the co-sign session and budget dial from the
  // main ask flow, and threads under this dispatch so the two answers can be read side by side.
  const reAsk = `/?q=${encodeURIComponent(question)}&parent=${dispatchId}&run=1`;

  return (
    <section
      aria-label="Answer freshness"
      className="mt-8 max-w-[860px] border-2 border-ink bg-paper p-[5px]"
    >
      <div className="border border-ink px-5 py-4">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-seal">
          New material since this dispatch
        </p>
        <p className="mt-2 font-serif text-[15px] leading-[1.6] text-ink">
          {newItems} new post{newItems !== 1 ? "s" : ""} {newItems !== 1 ? "have" : "has"} been
          published by {publisherPhrase(sources.length, citedCount)}. This dispatch never read{" "}
          {newItems !== 1 ? "them" : "it"} — it was settled before{" "}
          {newItems !== 1 ? "they" : "it"} existed.
        </p>
        <ul className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {sources.map((s) => (
            <li key={s.sourceId}>
              <Link
                href={`/creator/${s.sourceId}`}
                className="border border-line px-2 py-0.5 font-mono text-[10px] text-ink-2 transition-colors hover:border-seal hover:text-seal"
              >
                {s.name} · +{s.newItems}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[46ch] font-mono text-[10px] leading-[1.5] text-ink-3">
            Re-asking dispatches the same question again — it buys the new material and pays the
            creators for it. The answer above stays where it is.
          </p>
          <Link
            href={reAsk}
            className="border border-ink bg-ink px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-cream transition-opacity hover:opacity-85"
          >
            Re-ask on fresh sources
          </Link>
        </div>
      </div>
    </section>
  );
}
