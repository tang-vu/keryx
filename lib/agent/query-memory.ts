/**
 * Query Memory — what past runs taught the agent about its sources.
 *
 * After each dispatch the agent records which sources were on the table and which of them earned a
 * citation. Before the next one, that record is summarised into the `decide` prompt so a BUY/SKIP
 * call can be informed by how a source has actually performed rather than by its blurb alone.
 *
 * Two properties decide whether that summary helps or misleads:
 *
 *   - **It is scored per subject.** A source is measured only against past runs whose question
 *     shares vocabulary with the one being asked. Scored against every run instead, a specialist
 *     cited nearly every time it was relevant reads as an 8%-hit-rate dud (it is irrelevant to the
 *     other 92%), while a broad source that appears everywhere reads as excellent. An agent told
 *     that buys breadth and skips the source that would actually have answered the question.
 *   - **It records readings, not just citations.** A run that paid for a source and then quoted
 *     none of it is the only evidence that the source does not earn its toll. Keeping citations
 *     alone leaves the agent with purely positive evidence about the sources it already buys, which
 *     compounds: what gets bought gets cited, and what gets cited gets bought.
 *
 * The denominator is deliberately *runs that read the source*, not *runs where it was listed*. A
 * source the agent skipped was never given the chance to be cited; scoring that as a miss would let
 * one skip justify the next, and a newly listed source would be condemned before it was ever tried.
 *
 * Where the evidence is too thin to support either property, this module returns nothing. A prompt
 * with no history in it is merely uninformed; one carrying a rate computed off the wrong subject,
 * or off a denominator the data cannot support, is confidently wrong.
 */

import { topicTokens } from "../answers-topics";
import type { KeryxDB, QueryMemoryEntry } from "../db/keryx-db";
import type { Citation } from "../types";

/** Past runs pulled before the subject filter. Deliberately larger than the number finally scored:
 *  relevance is what makes the record meaningful, and it can reject most of a recent window. */
const MEMORY_POOL = 300;

/** Subject-relevant runs scored per source — the most recent win. Caps prompt size on hot topics. */
const MAX_SCORED = 60;

/** Below this many relevant runs, a hit rate is an accident of sampling rather than a signal. */
const MIN_SAMPLE = 5;

/** Sources described to the engine. More than this is a wall of text the prompt cannot use. */
const MAX_LINES = 12;

/** A source a run could have cited, identified for the summary. */
export interface MemoryCandidate {
  id: string;
  name: string;
}

/**
 * Save what this run learned about the sources it read.
 *
 * Unlike the citation log this is written even when nothing was cited: a run that paid to read the
 * corpus and found none of it worth quoting is exactly the evidence the next decision needs.
 */
export async function saveMemory(
  db: KeryxDB,
  queryId: string,
  question: string,
  citations: Citation[],
  sourcesRead: string[],
): Promise<void> {
  // Nothing was read, so the run says nothing about any source either way.
  if (sourcesRead.length === 0) return;

  const sourceScores: Record<string, { name: string; weight: number; reward: number }> = {};
  for (const c of citations) {
    sourceScores[c.sourceId] = { name: c.sourceName, weight: c.weight, reward: c.reward };
  }

  await db.saveQueryMemory({
    id: queryId,
    sourceScores,
    sourcesRead,
    topics: [...topicTokens(question)],
    createdAt: new Date().toISOString(),
  });
}

/** One source's record across the runs that shared this question's subject. */
interface SourceRecord {
  id: string;
  name: string;
  /** Relevant runs in which it earned a citation. */
  cited: number;
  /** Relevant runs in which it was read at all — the honest denominator. */
  read: number;
  rate: number;
  avgWeight: number;
  avgReward: number;
}

/**
 * Past runs on the same subject as this question, best match first.
 *
 * Stored topics are re-tokenised rather than compared as written: entries saved before this module
 * shared the archive's tokeniser kept unstemmed words, and "transfers" must still meet "transfer".
 * Entries with no read list predate that column — they can show that a source *was* cited but never
 * that it was read and passed over, so including them would rebuild the positive-only bias inside a
 * denominator that looks rigorous. They are dropped.
 *
 * One shared token is enough to qualify, which does let a homonym in — measured against the live
 * log, "prune tomato plants" binds to runs about pruning chain state. Demanding two shared tokens
 * removes that but also silences short questions squarely on subject ("how does x402 settle a
 * per-request toll" shares two tokens with exactly one past run), and a missing record costs the
 * decision more than a weak one. Instead the window is filled by overlap strength, so where a
 * subject is well covered the closest matches crowd out the coincidental ones. Sort is stable, so
 * equally-matched runs keep the caller's recency order.
 */
function relevantMemories(memories: QueryMemoryEntry[], question: string): QueryMemoryEntry[] {
  const asked = topicTokens(question);
  if (asked.size === 0) return [];
  const scored: { memory: QueryMemoryEntry; overlap: number }[] = [];
  for (const m of memories) {
    if (!Array.isArray(m.sourcesRead) || m.sourcesRead.length === 0) continue;
    let overlap = 0;
    for (const t of topicTokens((m.topics ?? []).join(" "))) if (asked.has(t)) overlap++;
    if (overlap > 0) scored.push({ memory: m, overlap });
  }
  scored.sort((a, b) => b.overlap - a.overlap);
  return scored.slice(0, MAX_SCORED).map((s) => s.memory);
}

/**
 * Score this run's candidates against past runs on the same subject.
 * Returns an empty list when the relevant sample is too thin to say anything.
 */
function scoreCandidates(
  memories: QueryMemoryEntry[],
  question: string,
  candidates: MemoryCandidate[],
): { records: SourceRecord[]; sample: number } {
  const relevant = relevantMemories(memories, question);
  if (relevant.length < MIN_SAMPLE) return { records: [], sample: relevant.length };

  const byId = new Map(candidates.map((c) => [c.id, c.name]));
  const acc = new Map<string, { cited: number; read: number; weight: number; reward: number }>();

  for (const m of relevant) {
    for (const id of m.sourcesRead!) {
      if (!byId.has(id)) continue; // not on the table for the run being decided now
      const rec = acc.get(id) ?? { cited: 0, read: 0, weight: 0, reward: 0 };
      rec.read++;
      const hit = m.sourceScores[id];
      if (hit) {
        rec.cited++;
        rec.weight += hit.weight;
        rec.reward += hit.reward;
      }
      acc.set(id, rec);
    }
  }

  const records: SourceRecord[] = [];
  for (const [id, r] of acc) {
    records.push({
      id,
      name: byId.get(id)!,
      cited: r.cited,
      read: r.read,
      rate: r.read === 0 ? 0 : r.cited / r.read,
      avgWeight: r.cited === 0 ? 0 : Math.round((r.weight / r.cited) * 100) / 100,
      avgReward: r.cited === 0 ? 0 : Math.round((r.reward / r.cited) * 10000) / 10000,
    });
  }
  // Best-performing first; ties broken by the source with more runs behind its number.
  records.sort((a, b) => b.rate - a.rate || b.read - a.read);
  return { records: records.slice(0, MAX_LINES), sample: relevant.length };
}

function runs(n: number): string {
  return `${n} run${n === 1 ? "" : "s"}`;
}

/** Per-source track record on this subject, as prose for the decide prompt. */
function memoryLines(records: SourceRecord[], sample: number): string {
  const lines = records.map((r) =>
    r.cited === 0
      ? `${r.name}: read in ${runs(r.read)} on this subject, never cited`
      : `${r.name}: cited in ${r.cited} of ${runs(r.read)} that read it on this subject ` +
        `(${Math.round(r.rate * 100)}%, avg weight ${r.avgWeight}, avg reward $${r.avgReward.toFixed(4)})`,
  );
  return (
    `How these sources performed on past questions about this subject (${runs(sample)}):\n` +
    `${lines.join("\n")}\n` +
    `A source that keeps earning citations here is worth its toll; one repeatedly read and left ` +
    `unquoted is not. Sources absent from this list have not been read on this subject — that is ` +
    `no evidence against them.`
  );
}

/** ERC-8004-style composite score: how often it is cited when available, times how much it carried. */
function reputationLines(records: SourceRecord[]): string {
  const ranked = records
    .map((r) => ({ name: r.name, score: Math.round(r.rate * r.avgWeight * 100), cited: r.cited }))
    .sort((a, b) => b.score - a.score);

  const lines = ranked.map((r) => {
    const tier = r.score >= 50 ? "★★★" : r.score >= 25 ? "★★" : r.score >= 10 ? "★" : "·";
    return `${tier} ${r.name}: reputation ${r.score}/100 (${r.cited} citation${r.cited === 1 ? "" : "s"} on this subject)`;
  });

  return (
    `Creator reputation on this subject (citation rate when available × average weight carried):\n` +
    `${lines.join("\n")}\n` +
    `Prefer the higher-reputation source when two look equally promising.`
  );
}

/**
 * Both halves of the historical context for one decide() call, from a single read of the log.
 * Either field is absent when the evidence behind it would not survive being written down.
 */
export async function buildDecisionContext(
  db: KeryxDB,
  question: string,
  candidates: MemoryCandidate[],
): Promise<{ memory?: string; reputation?: string; sample: number }> {
  if (candidates.length === 0) return { sample: 0 };
  const memories = await db.loadQueryMemories(MEMORY_POOL);
  const { records, sample } = scoreCandidates(memories, question, candidates);
  if (records.length === 0) return { sample };
  return { memory: memoryLines(records, sample), reputation: reputationLines(records), sample };
}
