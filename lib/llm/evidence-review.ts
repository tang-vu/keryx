import type { ProposedEvidence } from "./reasoning-engine";

export const MAX_REVIEWED_EVIDENCE = 32;

/** Review may only reduce the model's original support. Missing/ambiguous reviews fail closed. */
export function applyEvidenceReview(proposals: ProposedEvidence[], response: unknown): ProposedEvidence[] {
  const rows = response && typeof response === "object" && Array.isArray((response as { reviews?: unknown }).reviews)
    ? (response as { reviews: unknown[] }).reviews : [];
  const scores = new Map<number, number>();
  const duplicates = new Set<number>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (typeof item.index !== "number" || !Number.isInteger(item.index) || item.index < 0 || item.index >= Math.min(proposals.length, MAX_REVIEWED_EVIDENCE)) continue;
    if (scores.has(item.index)) duplicates.add(item.index);
    scores.set(item.index, typeof item.support === "number" && Number.isFinite(item.support)
      ? Math.max(0, Math.min(1, item.support)) : 0);
  }
  return proposals.map((proposal, index) => ({ ...proposal,
    support: Math.min(Number.isFinite(proposal.support) ? Math.max(0, proposal.support) : 0,
      duplicates.has(index) ? 0 : scores.get(index) ?? 0),
  }));
}
