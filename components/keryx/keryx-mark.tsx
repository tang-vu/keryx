/**
 * Keryx wordmark + coin glyph. The mark is the herald's coin — an italic
 * engraved "K" struck inside a ringed token (citations are currency). Color is
 * driven by `currentColor`, so the same glyph reads on ivory (seal) or on the
 * dark footer (a lighter coral).
 */

import { cn } from "@/lib/utils";

export function KeryxGlyph({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-current font-serif italic leading-none",
        className,
      )}
      style={{ width: 30, height: 30, fontSize: 18 }}
    >
      K
    </span>
  );
}

export function KeryxWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <KeryxGlyph className="text-seal" />
      <span className="font-serif text-[22px] leading-none tracking-tight text-foreground">
        Keryx
      </span>
    </span>
  );
}
