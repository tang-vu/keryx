/**
 * Answer-archive selection: turns the raw run log into a public, index-worthy
 * corpus. Two jobs the SEO surface depends on:
 *   1. Keep only real answers — a non-empty answer that actually cited a source.
 *   2. Dedupe by question — the volume engine reruns the same questions, and a
 *      pile of near-identical pages reads as doorway spam to a crawler. We keep
 *      one canonical dispatch per question (the richest one) and drop the rest.
 * Pure functions so the page stays lean and the selection logic stays testable.
 */

import type { QueryRun } from "./types";

export interface ArchiveEntry {
  id: string;
  question: string;
  answerSnippet: string;
  citationCount: number;
  toCreators: number;
  totalSpent: number;
  sourceNames: string[];
  createdAt: string;
}

const SNIPPET_LEN = 220;

/** Normalize a question for dedupe: lowercase, collapse whitespace, drop trailing punctuation. */
export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim().replace(/[?!.\s]+$/, "");
}

/** Strip citation markers and light markdown so a snippet / structured-data string reads as prose. */
export function cleanText(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/\[S\d+\]/g, "") // citation markers like [S1]
    .replace(/[*_`>#]/g, "") // markdown emphasis / heading marks
    .replace(/\s+/g, " ")
    .trim();
}

/** Pick the better run to represent a question: most citations, then most paid out, then newest. */
function better(a: QueryRun, b: QueryRun): QueryRun {
  if (a.citations.length !== b.citations.length)
    return a.citations.length > b.citations.length ? a : b;
  if (a.totalToCreators !== b.totalToCreators)
    return a.totalToCreators > b.totalToCreators ? a : b;
  return a.createdAt >= b.createdAt ? a : b;
}

function toEntry(r: QueryRun): ArchiveEntry {
  const answer = cleanText(r.answer);
  return {
    id: r.id,
    question: r.question.trim(),
    answerSnippet:
      answer.length > SNIPPET_LEN ? answer.slice(0, SNIPPET_LEN).trimEnd() + "…" : answer,
    citationCount: r.citations.length,
    toCreators: r.totalToCreators,
    totalSpent: r.totalSpent,
    sourceNames: [...new Set(r.citations.map((c) => c.sourceName).filter(Boolean))],
    createdAt: r.createdAt,
  };
}

/**
 * Build the public answer archive from raw runs: real cited answers only,
 * one canonical dispatch per question, newest first.
 */
export function buildArchive(runs: QueryRun[]): ArchiveEntry[] {
  const best = new Map<string, QueryRun>();
  for (const r of runs) {
    if (!r.answer?.trim()) continue;
    if (!r.citations?.length) continue;
    const key = normalizeQuestion(r.question);
    if (!key) continue;
    const cur = best.get(key);
    best.set(key, cur ? better(cur, r) : r);
  }
  return [...best.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(toEntry);
}

// Words too common in questions to signal relatedness.
const STOPWORDS = new Set(
  "what who how why when where which does the and for are was were will would can could should has have had between from with this that not any their there".split(
    " ",
  ),
);

function questionTokens(q: string): Set<string> {
  return new Set(
    normalizeQuestion(q)
      .split(" ")
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Pick the archive entries most related to one dispatch. Shared cited sources
 * are the strongest signal (same creators = same beat), question-keyword
 * overlap breaks ties. When nothing overlaps, fill with the newest entries so
 * every answer page still links into the corpus instead of dead-ending — the
 * archive is only crawlable if its pages point at each other.
 */
export function relatedAnswers(
  current: { id: string; question: string; sourceNames: string[] },
  archive: ArchiveEntry[],
  limit = 4,
): ArchiveEntry[] {
  const curKey = normalizeQuestion(current.question);
  const curTokens = questionTokens(current.question);
  const curSources = new Set(current.sourceNames);

  const candidates = archive.filter(
    (e) => e.id !== current.id && normalizeQuestion(e.question) !== curKey,
  );

  const scored = candidates
    .map((e) => {
      const sharedSources = e.sourceNames.filter((s) => curSources.has(s)).length;
      let sharedTokens = 0;
      for (const t of questionTokens(e.question)) if (curTokens.has(t)) sharedTokens++;
      return { e, score: sharedSources * 2 + sharedTokens };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.e.createdAt < b.e.createdAt ? 1 : -1))
    .map((x) => x.e);

  const picked = scored.slice(0, limit);
  // Candidates are already newest-first (buildArchive order), so the fill is too.
  for (const e of candidates) {
    if (picked.length >= limit) break;
    if (!picked.includes(e)) picked.push(e);
  }
  return picked;
}
