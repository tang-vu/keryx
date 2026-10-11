"use client";

/**
 * "Check your feed" — the demand board put to the agent, against one writer's own posts.
 *
 * The board above it is a page of sentences, and reading it means guessing which of them your blog
 * already covers. This asks the agent instead, in the form it decides everything else: paste a
 * feed, and it comes back BUY or SKIP with the rationale it would carry on the money path, plus the
 * open claims it expects your posts to address.
 *
 * No wallet, no signature, nothing stored — the feed is read for the length of one request. Two
 * things the copy must keep saying, because they are what make the verdict honest: the agent judged
 * this feed on its own, with nothing else competing for the same budget, and it will judge it again
 * at dispatch time on the full text it pays for.
 */

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { useState } from "react";
import Link from "next/link";
import { Loader2, Rss } from "lucide-react";

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

interface Match {
  id: string;
  claim: string;
  coverage: number;
  seen: number;
  queryId: string;
  question: string;
  shared: string[];
  post?: { title: string; link: string };
}

interface Result {
  feed: { title: string; link: string; posts: number };
  gapsChecked: number;
  /** "model" — the agent decided; "words" — vocabulary overlap, reasoning was unreachable. */
  judged: "model" | "words";
  wouldBuy: boolean;
  rationale: string;
  expectedValue: number;
  matches: Match[];
}

export function FeedMatchForm({
  gapId,
  claim,
}: {
  /** Optional current-board gap id. The server resolves it again; it is never spend authority. */
  gapId?: string;
  claim?: string;
} = {}) {
  const [rssUrl, setRssUrl] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    const url = rssUrl.trim();
    if (!url || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/wanted/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rssUrl: url, ...(gapId ? { gapId } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.message ??
            (res.status === 429
              ? uiCopy("wantedFeed.rateLimit")
              : uiCopy("wantedFeed.readError")),
        );
      } else {
        setResult(data as Result);
      }
    } catch {
      setError(uiCopy("wantedFeed.unreachable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-14 border-2 border-ink bg-paper p-[5px]">
      <div className="border border-ink">
        <div className="flex items-center justify-between gap-4 border-b border-ink bg-ink px-5 py-3 text-cream">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.18em]">
            {gapId ? uiCopy("wantedFeed.claimTitle") : uiCopy("wantedFeed.title")}
          </span>
          <span className="hidden font-mono text-[10.5px] uppercase tracking-[0.12em] text-cream/70 sm:inline">
            {uiCopy("wantedFeed.privacy")}
          </span>
        </div>

        <div className="px-5 py-5 sm:px-6">
          <label htmlFor="feed-check" className="sr-only">
            {uiCopy("wantedFeed.urlLabel")}
          </label>
          <div className="flex items-center gap-2.5 border-b border-line pb-2 focus-within:border-ink">
            <Rss className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            <input
              id="feed-check"
              type="url"
              inputMode="url"
              value={rssUrl}
              onChange={(e) => setRssUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") check();
              }}
              maxLength={2048}
              placeholder="https://yourblog.com/feed.xml"
              className="w-full bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-ink-3/60"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-[46ch] font-mono text-[10px] leading-[1.5] text-ink-3">
              {uiCopy("wantedFeed.previewBoundary")}
            </p>
            <button
              type="button"
              onClick={check}
              disabled={!rssUrl.trim() || busy}
              className="inline-flex items-center gap-2 border border-ink bg-ink px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-cream transition-opacity disabled:opacity-40"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {busy ? uiCopy("wantedFeed.reading") : uiCopy("wantedFeed.submit")}
            </button>
          </div>

          {gapId && claim && (
            <p className="mt-4 border-l-2 border-seal pl-3 font-serif text-[14px] leading-snug text-ink-2">
              “{claim}”
            </p>
          )}

          {error && (
            <p className="mt-4 border border-line bg-paper-2 px-4 py-3 font-mono text-[11px] leading-relaxed text-ink-2">
              {error}
            </p>
          )}

          {result && <Verdict result={result} rssUrl={rssUrl.trim()} />}
        </div>
      </div>
    </section>
  );
}

function Verdict({ result, rssUrl }: { result: Result; rssUrl: string }) {
  const { feed, matches, gapsChecked, judged, wouldBuy, rationale } = result;
  const byModel = judged === "model";

  return (
    <div className="mt-6 border-t border-line pt-5">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
        {uiCopy(byModel ? (feed.posts === 1 ? (gapsChecked === 1 ? "wantedFeed.summaryAgent.oneOne" : "wantedFeed.summaryAgent.oneOther") : (gapsChecked === 1 ? "wantedFeed.summaryAgent.otherOne" : "wantedFeed.summaryAgent.otherOther")) : (feed.posts === 1 ? (gapsChecked === 1 ? "wantedFeed.summaryOffline.oneOne" : "wantedFeed.summaryOffline.oneOther") : (gapsChecked === 1 ? "wantedFeed.summaryOffline.otherOne" : "wantedFeed.summaryOffline.otherOther")), { title: feed.title, posts: feed.posts, claims: gapsChecked })}
      </p>

      {byModel && (
        <div className="mt-4 border border-ink bg-paper-2 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className={`font-mono text-[11px] uppercase tracking-[0.16em] ${
                wouldBuy ? "text-paid" : "text-ink-2"
              }`}
            >
              {wouldBuy ? uiCopy("wantedFeed.buy") : uiCopy("wantedFeed.skip")}
            </span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              {uiCopy("wantedFeed.expectedValue", { value: Math.round(result.expectedValue * 100) })}
            </span>
          </div>
          {rationale && (
            <p className="mt-2 font-serif text-[15px] leading-[1.5] text-ink">“{rationale}”</p>
          )}
        </div>
      )}

      {matches.length > 0 ? (
        <>
          <p className="mt-5 max-w-[62ch] font-serif text-[15px] leading-[1.55] text-ink-2">
            {byModel ? matches.length === 1 ? uiCopy("wantedFeed.matchesAgent.one") : uiCopy("wantedFeed.matchesAgent.other", { count: matches.length }) : matches.length === 1 ? uiCopy("wantedFeed.matchesOffline.one") : uiCopy("wantedFeed.matchesOffline.other", { count: matches.length })}
          </p>

          <ol className="mt-5 flex flex-col gap-3">
            {matches.map((m) => (
              <li key={m.claim} className="border border-line bg-paper-2 p-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                  {m.seen > 1 ? uiCopy("wantedFeed.coverageAsked", { coverage: Math.round(m.coverage * 100), count: m.seen }) : uiCopy("wantedFeed.coverage", { coverage: Math.round(m.coverage * 100) })}
                </span>

                <p className="mt-2 font-serif text-[15px] leading-snug text-ink">{m.claim}</p>

                <p className="mt-2.5 font-mono text-[10.5px] leading-relaxed text-ink-3">
                  {matchDescription(m)}
                </p>
                {m.post?.link && (
                  <Link
                    href={registrationHref(rssUrl, m)}
                    className="mt-3 inline-block border border-ink bg-seal px-3 py-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-paper transition-transform hover:-translate-y-0.5"
                  >
                    {uiCopy("wantedFeed.offerPost")}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="mt-5 max-w-[62ch] font-serif text-[15px] leading-[1.55] text-ink-2">
          {byModel && wouldBuy ? (
            <>
              {uiCopy("wantedFeed.buyWithoutMatches")}
            </>
          ) : (
            <>
              {uiCopy("wantedFeed.noMatches")}
            </>
          )}
        </p>
      )}

      <div className="mt-6">
        <Link
          href={
            matches[0]?.post?.link
              ? registrationHref(rssUrl, matches[0])
              : `/register?rss=${encodeURIComponent(rssUrl)}`
          }
          className="inline-block border border-ink bg-seal px-[18px] py-2.5 font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-paper transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)]"
        >
          {matches.length > 0 ? uiCopy("wantedFeed.list") : uiCopy("wantedFeed.listAnyway")}
        </Link>
        <p className="mt-3 max-w-[62ch] font-mono text-[10.5px] leading-relaxed text-ink-3">
          {uiCopy("wantedFeed.decisionBoundary")}
        </p>
      </div>
    </div>
  );
}

function registrationHref(rssUrl: string, match: Match): string {
  const params = new URLSearchParams({
    rss: rssUrl,
    gap: match.id,
    post: match.post?.link ?? "",
  });
  return `/register?${params.toString()}`;
}

function matchDescription(match: Match) {
  const question = <Link href={`/dispatch/${match.queryId}`} className="underline underline-offset-4 transition-colors hover:text-seal">“{match.question}”</Link>;
  if (!match.post) return uiRichCopy("wantedFeed.asked", { question });
  const post = match.post.link ? <a href={match.post.link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 transition-colors hover:text-seal">“{match.post.title}”</a> : <>“{match.post.title}”</>;
  return match.shared.length > 0 ? uiRichCopy("wantedFeed.postSharedAsked", { post, shared: match.shared.join(", "), question }) : uiRichCopy("wantedFeed.postAsked", { post, question });
}
