/**
 * "PAID IN FULL" wax/rubber stamp — slams down onto the settlement when the
 * herald has paid every cited creator. Vermillion ink with a fractal-noise
 * displacement filter for an uneven, inked-rubber edge; multiply-blended so it
 * sinks into the paper instead of sitting on top like a sticker.
 */

import { cn } from "@/lib/utils";

export function PaidStamp({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none select-none text-seal", className)}
      style={{
        mixBlendMode: "multiply",
        animation: "kxStamp .62s cubic-bezier(.18,.7,.16,1) both",
      }}
    >
      <svg viewBox="0 0 220 220" className="h-full w-full overflow-visible">
        <defs>
          <path id="kxStampRing" d="M110,28 a82,82 0 1,1 -0.1,0" fill="none" />
          <filter id="kxStampInk" x="-25%" y="-25%" width="150%" height="150%">
            <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
        <g filter="url(#kxStampInk)" stroke="currentColor" fill="currentColor">
          <circle cx="110" cy="110" r="101" fill="none" strokeWidth="3" />
          <circle cx="110" cy="110" r="88" fill="none" strokeWidth="1.5" />
          <text
            className="font-mono uppercase"
            style={{ fontSize: 13, letterSpacing: ".26em", stroke: "none" }}
          >
            <textPath href="#kxStampRing" startOffset="0">
              ★ PAID IN FULL ★ KERYX ★ USDC ON ARC&nbsp;
            </textPath>
          </text>
          <line x1="44" y1="92" x2="176" y2="92" strokeWidth="1.5" />
          <text
            x="110"
            y="132"
            textAnchor="middle"
            className="font-serif"
            style={{ fontWeight: 700, fontSize: 42, stroke: "none" }}
          >
            PAID
          </text>
          <line x1="44" y1="146" x2="176" y2="146" strokeWidth="1.5" />
          <text
            x="110"
            y="166"
            textAnchor="middle"
            className="font-mono"
            style={{ fontSize: 11, letterSpacing: ".22em", stroke: "none" }}
          >
            SETTLED · ARC
          </text>
        </g>
      </svg>
    </div>
  );
}
