/**
 * Keryx wordmark + glyph. The glyph is a stylized herald's horn / coin —
 * announces + is paid. Pure SVG, currentColor-driven, gold accent.
 */

import { cn } from "@/lib/utils";

export function KeryxGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cn("h-7 w-7", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="keryx-glyph" x1="4" y1="4" x2="28" y2="28">
          <stop offset="0" stopColor="#F59E0B" />
          <stop offset="1" stopColor="#B45309" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" stroke="url(#keryx-glyph)" strokeWidth="1.5" />
      {/* herald's horn radiating sound waves */}
      <path
        d="M11 16 L19 11 L19 21 Z"
        fill="url(#keryx-glyph)"
      />
      <path
        d="M21.5 13.5 C23 14.8 23 17.2 21.5 18.5"
        stroke="url(#keryx-glyph)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M23.8 11.5 C26.2 14 26.2 18 23.8 20.5"
        stroke="url(#keryx-glyph)"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

export function KeryxWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <KeryxGlyph />
      <span className="text-lg font-semibold tracking-tight text-foreground">
        Keryx
      </span>
    </span>
  );
}
