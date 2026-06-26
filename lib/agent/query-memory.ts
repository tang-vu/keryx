/**
 * Query Memory — cross-query learning module.
 *
 * After each successful dispatch, the agent saves a memory entry recording
 * which sources were cited, their weights, and topic keywords. Before the
 * next dispatch, it loads recent memories and builds a context string like:
 *   "Historical: Agent Economy Weekly cited 12/14 times (avg weight 0.35)
 *    for x402 topics. Garden & Soil cited 0/3 times."
 *
 * This context is injected into the decide() prompt so the agent makes
 * better-informed BUY/SKIP decisions based on accumulated experience.
 */

import type { KeryxDB } from "../db/keryx-db";
import type { Citation } from "../types";

/** Extract topic keywords from a question (simple: lowercase, deduplicated, top N). */
function extractTopics(question: string): string[] {
  const stop = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "about", "it", "its",
    "this", "that", "and", "or", "not", "no", "what", "how", "why", "when",
    "where", "which", "who", "does", "do", "is", "are", "any", "some",
    "all", "each", "every", "much", "many", "more", "most", "other",
    "such", "only", "own", "same", "than", "too", "very", "just",
    "i", "me", "my", "we", "our", "you", "your", "he", "she", "they",
    "us", "them", "their", "but", "if", "then", "so", "up", "out",
  ]);
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  // Deduplicate and take top 8
  return [...new Set(words)].slice(0, 8);
}

/** Save a memory entry from the current run's citations. */
export async function saveMemory(
  db: KeryxDB,
  queryId: string,
  question: string,
  citations: Citation[],
): Promise<void> {
  if (citations.length === 0) return; // nothing to learn from

  const sourceScores: Record<string, { name: string; weight: number; reward: number }> = {};
  for (const c of citations) {
    sourceScores[c.sourceId] = {
      name: c.sourceName,
      weight: c.weight,
      reward: c.reward,
    };
  }

  await db.saveQueryMemory({
    id: queryId,
    sourceScores,
    topics: extractTopics(question),
    createdAt: new Date().toISOString(),
  });
}

/** Aggregated per-source stats from recent memories. */
interface SourceStat {
  name: string;
  citedCount: number; // times this source appeared in citations
  totalQueries: number; // total queries where this source was a candidate
  avgWeight: number;
  avgReward: number;
}

/**
 * Load recent memories and build a context string for the decide() prompt.
 * Returns an empty string if no memories exist (first queries have no history).
 */
export async function buildMemoryContext(
  db: KeryxDB,
  question: string,
  candidateIds: string[],
  maxMemories = 50,
): Promise<string> {
  const memories = await db.loadQueryMemories(maxMemories);
  if (memories.length === 0) return "";

  const questionTopics = new Set(extractTopics(question));

  // Aggregate per-source stats across all memories
  const stats = new Map<string, SourceStat>();
  for (const mem of memories) {
    for (const [sid, data] of Object.entries(mem.sourceScores)) {
      const existing = stats.get(sid);
      if (existing) {
        existing.citedCount++;
        existing.totalQueries++;
        existing.avgWeight += data.weight;
        existing.avgReward += data.reward;
      } else {
        stats.set(sid, {
          name: data.name,
          citedCount: 1,
          totalQueries: 1,
          avgWeight: data.weight,
          avgReward: data.reward,
        });
      }
    }
  }

  // Finalize averages
  for (const s of stats.values()) {
    s.avgWeight = Math.round((s.avgWeight / s.citedCount) * 100) / 100;
    s.avgReward = Math.round((s.avgReward / s.citedCount) * 10000) / 10000;
  }

  // Filter to only candidates in the current decision set
  const relevant = candidateIds
    .map((id) => {
      const s = stats.get(id);
      if (!s) return null;
      return { id, ...s };
    })
    .filter(Boolean) as (SourceStat & { id: string })[];

  if (relevant.length === 0) return "";

  // Sort by citation count (most experienced first)
  relevant.sort((a, b) => b.citedCount - a.citedCount);

  // Build the context string
  const lines = relevant.slice(0, 10).map((s) => {
    const hitRate = Math.round((s.citedCount / memories.length) * 100);
    return `${s.name}: cited ${s.citedCount}/${memories.length} runs (${hitRate}% hit rate, avg weight ${s.avgWeight}, avg reward $${s.avgReward.toFixed(4)})`;
  });

  const topicMatch = [...questionTopics].slice(0, 3).join(", ");
  const topicNote = topicMatch ? ` (topics: ${topicMatch})` : "";

  return `Historical source performance from ${memories.length} past queries${topicNote}:\n${lines.join("\n")}\nUse this data to inform your BUY/SKIP decisions — sources with high hit rates and weights are consistently valuable.`;
}

/**
 * Build an ERC-8004-style reputation context string from query memories.
 * Reputation score = (citationRate × avgWeight), combining reliability + quality.
 * This is separate from buildMemoryContext and focuses on a single composite score
 * per source, displayed as a reputation badge.
 */
export async function buildReputationContext(
  db: KeryxDB,
  candidateIds: string[],
): Promise<string> {
  const memories = await db.loadQueryMemories(50);
  if (memories.length === 0) return "";

  const scores = new Map<string, { name: string; score: number; citations: number }>();

  for (const mem of memories) {
    for (const [sid, data] of Object.entries(mem.sourceScores)) {
      const existing = scores.get(sid);
      if (existing) {
        existing.citations++;
        existing.score += data.weight;
      } else {
        scores.set(sid, { name: data.name, score: data.weight, citations: 1 });
      }
    }
  }

  // Compute composite reputation: citationRate × avgWeight
  const ranked = candidateIds
    .map((id) => {
      const s = scores.get(id);
      if (!s) return null;
      const citationRate = s.citations / memories.length;
      const avgWeight = s.score / s.citations;
      const reputation = Math.round(citationRate * avgWeight * 100);
      return { id, name: s.name, reputation, citations: s.citations };
    })
    .filter(Boolean) as { id: string; name: string; reputation: number; citations: number }[];

  if (ranked.length === 0) return "";

  ranked.sort((a, b) => b.reputation - a.reputation);

  const lines = ranked.slice(0, 8).map((r) => {
    const tier = r.reputation >= 50 ? "★★★" : r.reputation >= 25 ? "★★" : r.reputation >= 10 ? "★" : "·";
    return `${tier} ${r.name}: reputation ${r.reputation}/100 (${r.citations} citations across ${memories.length} runs)`;
  });

  return `ERC-8004 Creator Reputation (composite: citationRate × avgWeight):\n${lines.join("\n")}\nHigher reputation = more trustworthy source. Prefer high-reputation sources when value is similar.`;
}
