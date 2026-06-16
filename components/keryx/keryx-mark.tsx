/**
 * Keryx wordmark + coin glyph. The mark is a *minted coin* — a Bodoni "K"
 * struck inside a double ring with a reeded (milled) edge, exactly like the
 * ridges on a real coin: citations are currency. Color is `currentColor`, so
 * the same glyph reads on ivory (seal) or on the dark footer (a lighter coral).
 */

import { cn } from "@/lib/utils";

const REEDS = Array.from({ length: 90 }, (_, i) => (i / 90) * Math.PI * 2);

export function KeryxGlyph({
  className,
  size = 30,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn("shrink-0 text-seal", className)}
      aria-hidden
    >
      <g stroke="currentColor">
        {REEDS.map((a, i) => (
          <line
            key={i}
            x1={50 + Math.cos(a) * 46}
            y1={50 + Math.sin(a) * 46}
            x2={50 + Math.cos(a) * 49.3}
            y2={50 + Math.sin(a) * 49.3}
            strokeWidth={1.5}
          />
        ))}
        <circle cx="50" cy="50" r="44" fill="none" strokeWidth="2" />
        <circle cx="50" cy="50" r="37.5" fill="none" strokeWidth="0.9" />
      </g>
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        className="font-display"
        style={{ fontSize: 46, fontStyle: "italic", fontWeight: 600 }}
      >
        K
      </text>
    </svg>
  );
}

export function KeryxWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <KeryxGlyph className="text-seal" size={32} />
      <span className="font-display text-[23px] font-medium leading-none tracking-tight text-foreground">
        Keryx
      </span>
    </span>
  );
}
