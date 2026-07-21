/**
 * The agent's own trust level, struck as a wax-seal chip. A citation-toll agent that says "Low
 * confidence" up front is more trustworthy than one that states everything with equal certainty —
 * so the badge is prominent, not buried.
 *
 * Server component (no client JS): it renders the same on the permalink, the archive list and the
 * OG metadata path.
 */

import type { Confidence } from "@/lib/types";

const TONE: Record<Confidence["level"], string> = {
  High: "border-paid/50 bg-paid/[0.08] text-paid",
  Moderate: "border-seal/45 bg-seal/[0.06] text-seal",
  Low: "border-ink-3/45 bg-ink-3/[0.06] text-ink-3",
};

export function ConfidenceBadge({
  confidence,
  showReason = false,
  className = "",
}: {
  confidence: Confidence;
  showReason?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] ${TONE[confidence.level]} ${className}`}
      title={confidence.reason}
    >
      <span className="font-semibold">{confidence.level}</span>
      <span className="opacity-70">confidence</span>
      {showReason && confidence.reason ? (
        <span className="ml-1 normal-case tracking-normal opacity-80">— {confidence.reason}</span>
      ) : null}
    </span>
  );
}
