"use client";

/**
 * Real/offline mode badge. "live on Arc testnet" (treasury green, pulsing dot)
 * vs "offline preview — payments simulated" (quiet ink).
 */

import type { StreamMode } from "@/lib/hooks/use-ask-stream";
import { cn } from "@/lib/utils";

export function ModeBadge({
  mode,
  className,
}: {
  mode: StreamMode | null;
  className?: string;
}) {
  if (!mode) return null;
  const real = mode === "real";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px]",
        real
          ? "border-paid/30 bg-paid/10 text-paid"
          : "border-line bg-paper-2 text-ink-3",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          real ? "animate-pulse bg-paid" : "bg-ink-3/50",
        )}
      />
      {real ? "live on Arc testnet" : "offline preview · simulated"}
    </span>
  );
}
