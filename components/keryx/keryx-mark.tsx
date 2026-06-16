/**
 * Keryx wordmark + the minted coin. A Bodoni "K" struck inside a double ring
 * with a reeded (milled) edge — a citation as a unit of currency. The favicon
 * variant drops the reeding for clarity at small sizes. `currentColor`-driven.
 */

import { cn } from "@/lib/utils";

const BODONI = "var(--font-bodoni), 'Bodoni Moda', Georgia, serif";

export function KeryxGlyph({
  className,
  size = 30,
  reeded = true,
}: {
  className?: string;
  size?: number;
  reeded?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      className={cn("block shrink-0 text-seal", className)}
      aria-hidden
    >
      <circle cx="80" cy="80" r="76" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="80" cy="80" r={reeded ? 60 : 64} fill="none" stroke="currentColor" strokeWidth="1" />
      {reeded && (
        <circle
          cx="80"
          cy="80"
          r="68"
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeDasharray="2.2 7.1"
        />
      )}
      <text
        x="80"
        y="110"
        textAnchor="middle"
        fill="currentColor"
        style={{ fontFamily: BODONI, fontWeight: 700, fontSize: 86 }}
      >
        K
      </text>
    </svg>
  );
}

export function KeryxWordmark({
  className,
  tagline,
}: {
  className?: string;
  tagline?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <KeryxGlyph size={30} />
      <span className="flex flex-col">
        <span className="font-display text-[23px] font-bold leading-none tracking-[0.01em] text-ink">
          Keryx
        </span>
        {tagline && (
          <span className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.36em] text-ink-3">
            The citation toll
          </span>
        )}
      </span>
    </span>
  );
}
