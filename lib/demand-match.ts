/**
 * Word overlap between a feed's posts and the open demand board — the degraded path.
 *
 * The feed check is judged by the reasoning engine (`demand-match-judge.ts`), because measuring
 * this against the live board and eight real feeds showed overlap cannot tell coverage from
 * coincidence: its best pairs answered "Caching reduces bandwidth and latency costs" with a post
 * about a bank's stablecoin pilot. It survives for the case where no model is reachable, tuned so
 * that when it is wrong it is silent rather than wrong out loud:
 *
 *  - **Half the claim's vocabulary, at minimum two words.** On real feeds this returns nothing or
 *    one thing. That is the intended failure mode for a page inviting someone to do work.
 *  - **One post must carry the claim.** Overlap is computed per post rather than against the feed's
 *    combined vocabulary, where a claim could be "covered" by three unrelated articles between
 *    them. The matching post travels with the result so the reader can check the call.
 *  - **Matched on the free preview.** Title and summary are what the agent sees before it decides
 *    to buy; scoring the paid body would promise coverage on evidence the agent never gets.
 *
 * Whatever this returns is labelled as word overlap where it surfaces — never as the agent's
 * judgment, which is a different thing arrived at a different way.
 */

import { topicTokens } from "./answers-topics";
import type { DemandGap } from "./demand-signal";

/** A post as it arrives from a feed, before anything is listed or stored. */
export interface FeedPost {
  title: string;
  summary: string;
  link?: string;
  publishedAt?: string;
}

export interface GapMatch {
  gap: DemandGap;
  /** Share of the claim's subject words this post carries, 0..1. */
  score: number;
  /** The words they have in common — the whole basis of the call, shown rather than summarised. */
  shared: string[];
  post: FeedPost;
}

export interface MatchOptions {
  /** Share of the claim's vocabulary a post must carry. */
  minScore?: number;
  /** Absolute floor under the share: one word in common is a coincidence, not a subject. */
  minShared?: number;
  limit?: number;
}

const DEFAULTS = { minScore: 0.5, minShared: 2, limit: 10 } satisfies Required<MatchOptions>;

/**
 * The open claims this feed appears to answer, best match first.
 *
 * `gaps` must be the open list — a hole already filled is not an opportunity, and offering it as
 * one would send a writer to a brief the corpus has already served.
 */
export function matchFeedToGaps(
  gaps: DemandGap[],
  posts: FeedPost[],
  options: MatchOptions = {},
): GapMatch[] {
  const { minScore, minShared, limit } = { ...DEFAULTS, ...options };

  // Tokenise each post once: the feed is read against every gap, and topicTokens does real work.
  const tokenised = posts.map((post) => ({
    post,
    tokens: topicTokens(`${post.title} ${post.summary}`),
  }));

  const matches: GapMatch[] = [];
  for (const gap of gaps) {
    const claimTokens = topicTokens(gap.claim);
    if (claimTokens.size === 0) continue;

    let best: GapMatch | undefined;
    for (const { post, tokens } of tokenised) {
      const shared = [...claimTokens].filter((t) => tokens.has(t));
      if (shared.length < minShared) continue;
      const score = shared.length / claimTokens.size;
      if (score < minScore) continue;
      // Ties keep the earlier post: feeds arrive newest-first, so the freshest of two equally
      // good answers is the one offered.
      if (!best || score > best.score) best = { gap, score, shared, post };
    }
    if (best) matches.push(best);
  }

  return matches
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.gap.seen - a.gap.seen ||
        a.gap.coverage - b.gap.coverage ||
        a.gap.claim.localeCompare(b.gap.claim),
    )
    .slice(0, limit);
}
