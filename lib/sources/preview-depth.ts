/**
 * Preview depth — a creator's choice of how much of each item a free preview may reveal.
 *
 * The free preview is what the agent (and any human browsing) reads BEFORE deciding to pay the
 * fetch toll. It is the incentive dial: reveal the whole summary and a cheap agent may score the
 * source well without ever buying; reveal nothing and the agent has only the source's name, tags,
 * and description to score on, so it may skip a source that would have been worth citing. The right
 * setting is the creator's call, not ours — this module just applies it consistently everywhere a
 * preview is produced (the /preview route AND the agent's discover step), so the two never drift.
 *
 * Levels (operate on an item's already-truncated RSS summary, never the paid full text):
 *   full    — title + summary (the default, most discoverable)
 *   excerpt — title + a short teaser of the summary
 *   locked  — title only; the summary is withheld until the toll is paid
 */

export type PreviewDepth = "full" | "excerpt" | "locked";

export const PREVIEW_DEPTHS: readonly PreviewDepth[] = ["full", "excerpt", "locked"] as const;

export const DEFAULT_PREVIEW_DEPTH: PreviewDepth = "full";

/** Teaser length for the "excerpt" level. Long enough to convey topic, short enough to still sell. */
const EXCERPT_CHARS = 120;

/** Coerce arbitrary input (DB value, request body) to a valid level; anything unknown → full. */
export function normalizePreviewDepth(v: unknown): PreviewDepth {
  return v === "excerpt" || v === "locked" ? v : DEFAULT_PREVIEW_DEPTH;
}

/** Truncate at a word boundary near `max`, appending an ellipsis only when actually cut. */
function truncateAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // Prefer the last word boundary, but don't chop off more than ~40% to reach one.
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.trimEnd() + "…";
}

/**
 * The summary text a preview may show for this item under `depth`. Empty string means "title only"
 * — callers render just the title in that case. Never touches the full paid content.
 */
export function previewSummary(summary: string | undefined, depth: PreviewDepth): string {
  if (depth === "locked") return "";
  const s = summary ?? "";
  return depth === "excerpt" ? truncateAtWord(s, EXCERPT_CHARS) : s;
}

/** Human-readable one-liner for the picker UI, so the copy lives next to the levels it describes. */
export const PREVIEW_DEPTH_LABELS: Record<PreviewDepth, { label: string; hint: string }> = {
  full: { label: "Full summary", hint: "Title + full summary — most discoverable" },
  excerpt: { label: "Short excerpt", hint: "Title + a brief teaser of each item" },
  locked: { label: "Titles only", hint: "Headlines only; the summary needs the toll" },
};
