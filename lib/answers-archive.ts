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
