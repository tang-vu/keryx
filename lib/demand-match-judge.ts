/**
 * Would Keryx buy this feed? — the demand board put to the agent that spends the money.
 *
 * Two wrong answers were built before this one, and both are worth recording because they look
 * right until they meet real data:
 *
 *  1. **Word overlap** between claims and posts. Measured against the live board and eight real
 *     feeds, its best pairs answered "Caching reduces bandwidth and latency costs" with a post about
 *     a bank's stablecoin pilot. Shared vocabulary between a ten-word claim and a 280-character
 *     summary is not evidence, and no threshold separates the two — strict says nothing, loose says
 *     nonsense. It survives below as the degraded path, tuned to be silent rather than wrong.
 *  2. **Asking whether the previews *support* the claims** (the `sufficiency` step, whose verdicts
 *     the board is assembled from). The model answered honestly and answered 0.2 to everything,
 *     including for a feed that genuinely covers the subject — because a title and a summary never
 *     support anything. That is the entire reason the agent pays for the full text.
 *
 * So the question asked here is the one the agent actually asks about a source it has not read:
 * `decide` — worth buying, or not? The feed is presented exactly as a listed source is at discovery
 * (four recent items, `- title: summary`), and comes back with BUY or SKIP, a rationale, and the
 * sub-claims the agent expects it to address. A creator gets the same verdict their source would
 * get on the money path, before doing the work of listing it.
 *
 * The one distortion, stated where the reader can see it: a real decision ranks a source against
 * everything else on the shelf, and this one has no competition. It answers "is this worth buying",
 * not "is this the best buy".
 */

import { config } from "./config";
import { effectiveEngineName } from "./llm/resilient-engine";
import { matchFeedToGaps, type FeedPost } from "./demand-match";
import type { DemandGap } from "./demand-signal";
import type { ReasoningEngine, SourceCandidate } from "./llm/reasoning-engine";

/** Claims put to the agent in one decision. One candidate means one reply, so this can be wide.
 *  Narrow it and the tool only ever offers the board's niche head: at 20, a feed that genuinely
 *  covers the corpus's broader claims was told to go away. */
const MAX_CLAIMS = 40;
/** Items shown, matching what discovery shows the agent for a listed source. */
const PREVIEW_ITEMS = 4;
/**
 * A target list this large is the agent saying "broadly relevant", not "these ones".
 *
 * Offered forty claims, it came back naming thirty-six of them. Printing that as "the claims your
 * posts address" would dress an unspecific judgment as precision, and every one of those lines is
 * something a writer might go and work on. Past this share the list is dropped and the verdict
 * stands on its own — but never below `ALWAYS_SPECIFIC`, because on a board of two, naming both is
 * the only specific answer there is.
 */
const SPECIFIC_SHARE = 0.5;
const ALWAYS_SPECIFIC = 3;
/** Even a specific list is a to-do list; more than this many is not read, it is skimmed. */
const MAX_SHOWN = 8;

export interface FeedMatch {
  gap: DemandGap;
  /** Only on the degraded path, where a specific post is the whole basis of the guess. */
  post?: FeedPost;
  /** Words the claim and that post share. Empty when the agent judged, where words are not why. */
  shared: string[];
}

export interface FeedVerdict {
  judged: "model" | "words";
  /** The agent's call on paying this feed's toll. Always false on the degraded path. */
  wouldBuy: boolean;
  /** The agent's own words for why — the same rationale a listed source's decision carries. */
  rationale: string;
  expectedValue: number;
  /** Open claims the agent expects this feed to address. */
  matches: FeedMatch[];
}

/**
 * Put an unlisted feed to the agent against the open board.
 *
 * Never throws: this answers a page a stranger is looking at, and a provider outage should cost it
 * precision, not the answer.
 */
export async function judgeFeedAgainstGaps(
  gaps: DemandGap[],
  posts: FeedPost[],
  engine: ReasoningEngine,
  feed: { title?: string; description?: string } = {},
): Promise<FeedVerdict> {
  const claims = gaps.slice(0, MAX_CLAIMS);
  const words = (): FeedVerdict => ({
    judged: "words",
    wouldBuy: false,
    rationale: "",
    expectedValue: 0,
    matches: matchFeedToGaps(gaps, posts).map((m) => ({
      gap: m.gap,
      post: m.post,
      shared: m.shared,
    })),
  });
  if (claims.length === 0 || posts.length === 0) return words();

  const title = feed.title?.trim() || "this feed";
  const candidate: SourceCandidate = {
    id: "candidate-feed",
    name: title,
    // The feed's own words, exactly as a listed source carries the creator's blurb. An earlier cut
    // described it as "unlisted" and the agent duly held that against it in its rationale — a
    // penalty this check invented, for a fact the money path never sees.
    description: feed.description?.trim() || title,
    tags: [],
    fetchPrice: config.defaultFetchPrice,
    cached: false,
    // Built the way discovery builds it, so the verdict is the one a listed source would get.
    preview: posts
      .slice(0, PREVIEW_ITEMS)
      .map((p) => (p.summary ? `- ${p.title}: ${p.summary}` : `- ${p.title}`))
      .join("\n"),
  };

  let decision;
  try {
    const decisions = await engine.decide({
      question:
        "Which of these open claims could this source answer? It is offered for listing on a " +
        "corpus that has been paid to answer them and could not.",
      subClaims: claims.map((g) => g.claim),
      candidates: [candidate],
      budget: config.defaultBudget,
      spentSoFar: 0,
    });
    // The deterministic heuristic's verdict is word overlap wearing the agent's clothes; reported
    // as a decision it would misdescribe how the answer was reached.
    if (effectiveEngineName(engine).startsWith("heuristic")) return words();
    decision = decisions[0];
  } catch {
    return words();
  }
  if (!decision) return words();

  const wouldBuy = decision.action !== "SKIP";
  // Indices the agent named, validated: a hallucinated one would otherwise put an arbitrary claim
  // in front of a writer as something their feed answers. Sorted back into board order, so the
  // eight that survive are the most-wanted eight rather than the first eight it happened to type.
  const targets = [...new Set(decision.targets)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < claims.length)
    .sort((a, b) => a - b);
  const specific =
    targets.length > 0 &&
    targets.length <= Math.max(ALWAYS_SPECIFIC, claims.length * SPECIFIC_SHARE);

  return {
    judged: "model",
    wouldBuy,
    rationale: decision.rationale,
    expectedValue: decision.expectedValue,
    // A skip's targets are not an opportunity — the agent has just said it would not pay for them.
    matches:
      wouldBuy && specific
        ? targets.slice(0, MAX_SHOWN).map((i) => ({ gap: claims[i]!, shared: [] }))
        : [],
  };
}
