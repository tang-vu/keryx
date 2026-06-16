/**
 * Herald's seal — the hero medallion. The legend "★ KERYX ★ THE HERALD IS PAID
 * ★ ΚΗΡΥΞ" rotates slowly around the engraved seal ring while a struck Bodoni
 * "K" holds the centre. States the thesis: the messenger is paid.
 */

import { cn } from "@/lib/utils";

export function HeraldSeal({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 160"
      aria-hidden
      className={cn("text-seal", className)}
    >
      <g style={{ transformOrigin: "80px 80px", animation: "kxSpinCW 70s linear infinite" }}>
        <text
          fill="currentColor"
          className="font-mono uppercase"
          style={{ fontSize: 13, letterSpacing: "0.32em" }}
        >
          <textPath href="#eng-sealring" startOffset="0">
            ★ KERYX ★ THE HERALD IS PAID ★ ΚΗΡΥΞ&nbsp;
          </textPath>
        </text>
      </g>
      <circle cx="80" cy="80" r="39" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <text
        x="80"
        y="80"
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        className="font-display"
        style={{ fontSize: 48, fontWeight: 700 }}
      >
        K
      </text>
    </svg>
  );
}
