/**
 * Herald's seal — a wax-stamp medallion whose outer legend rotates slowly:
 * "THE HERALD IS PAID · ΚΗΡΥΞ · USDC ON ARC" around a struck Bodoni "K". The
 * hero ornament that states the product's thesis: the messenger is paid.
 */

import { cn } from "@/lib/utils";

export function HeraldSeal({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("relative aspect-square text-seal", className)}
    >
      <svg viewBox="0 0 200 200" className="h-full w-full overflow-visible">
        <defs>
          <path id="kxSealRing" d="M100,20 a80,80 0 1,1 -0.1,0" fill="none" />
        </defs>
        <g
          className="kx-spin"
          style={{ transformOrigin: "100px 100px", animation: "kxSpinCW 28s linear infinite" }}
        >
          <text
            fill="currentColor"
            className="font-mono"
            style={{ fontSize: 11.5, letterSpacing: "0.22em" }}
          >
            <textPath href="#kxSealRing" startOffset="0">
              ★ THE HERALD IS PAID ★ ΚΗΡΥΞ ★ USDC ON ARC&nbsp;
            </textPath>
          </text>
        </g>
        <circle cx="100" cy="100" r="64" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="100" cy="100" r="57" fill="none" stroke="currentColor" strokeWidth="0.7" />
        <text
          x="100"
          y="103"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          className="font-display"
          style={{ fontSize: 66, fontStyle: "italic", fontWeight: 600 }}
        >
          K
        </text>
      </svg>
    </div>
  );
}
